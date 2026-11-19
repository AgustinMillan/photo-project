#!/usr/bin/env python3
"""Post-deploy smoke test: publish a QA storefront, upload, order, pay, download.

Runs on the server against the API on 127.0.0.1 (Host header selects the
tenant). Uses a dedicated QA account and store, and hides the QA storefront
at the end. Usage:
  set -a; . infra/deploy/.env; set +a
  DOMAIN=fotos.example.com python3 infra/deploy/smoke.py   # needs SMOKE_EMAIL and SMOKE_PASSWORD
"""
import hashlib, json, os, subprocess, sys, urllib.error, urllib.request, uuid

DEPLOY_DIR = os.path.dirname(os.path.abspath(__file__))
API = f"http://127.0.0.1:{os.environ.get('API_HOST_PORT', '3100')}/api/v1"
PANEL = os.environ["DOMAIN"]
SLUG = os.environ.get("SMOKE_SLUG", "qa-demo")
STORE_HOST = f"{SLUG}.{PANEL}"
EMAIL = os.environ["SMOKE_EMAIL"]
# Kept in infra/deploy/.env on the server; the first run registers the account with it.
PASSWORD = os.environ["SMOKE_PASSWORD"]

def call(method, path, body=None, token=None, host=PANEL, raw=None, ctype=None, origin=None):
    headers = {"Host": host}
    data = None
    if raw is not None:
        data, headers["Content-Type"] = raw, ctype
    elif body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    if token: headers["Authorization"] = f"Bearer {token}"
    if origin: headers["Origin"] = origin
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            payload = r.read()
            return r.status, (json.loads(payload) if r.headers.get("content-type","").startswith("application/json") else payload)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def ok(label, cond, extra=""):
    print(("OK  " if cond else "FAIL") + " " + label + (" " + str(extra) if extra else ""))
    if not cond: sys.exit(1)

def compose(*args, **kwargs):
    return subprocess.run(["docker", "compose", *args], capture_output=True, cwd=DEPLOY_DIR, **kwargs)

def admin(*args):
    return compose("exec", "-T", "api", "node", "dist/admin/cli.js", *args, text=True)

def test_image(color):
    script = (
        "const s=require('sharp');s({create:{width:1600,height:1067,channels:3,background:'%s'}})"
        ".jpeg().toBuffer().then(b=>process.stdout.write(b))" % color
    )
    return compose("exec", "-T", "api", "node", "-e", script).stdout

def multipart(blob, name):
    b = "----qa" + uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: image/jpeg\r\n\r\n").encode() + blob + f"\r\n--{b}--\r\n".encode()
    return body, f"multipart/form-data; boundary={b}"

s, r = call("POST", "/auth/register", {"email": EMAIL, "password": PASSWORD, "displayName": "QA"})
ok("registro", s in (201, 409), s)
admin("verify-email", EMAIL)
s, r = call("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
ok("login", s == 200, s)
tok = r["accessToken"]
call("POST", "/accounts", {"name": "QA Demo"}, tok)
s, r = call("GET", "/stores", token=tok)
stores = [st for st in r["stores"] if st.get("slug") == SLUG]
if not stores:
    s, r = call("POST", "/stores", {"name": "QA Demo", "slug": SLUG}, tok); ok("tienda", s == 201, s)
    store = r["store"]
else:
    store = stores[0]
sid = store["id"]

profile = {"displayName": "QA Demo", "tagline": "Prueba automática", "bio": "Tienda de prueba interna.", "contactEmail": "", "phone": "", "instagram": "", "website": "", "coverPhotoId": None, "paymentInstructions": "Alias: QA.DEMO.PRUEBA", "watermarkText": "QA DEMO", "sections": [{"key": k, "enabled": True} for k in ["hero","services","albums","about","contact"]], "services": []}
s, r = call("PUT", f"/stores/{sid}/storefront", profile, tok); ok("guardar borrador", s == 200, s)
s, r = call("POST", f"/stores/{sid}/storefront/publish", token=tok); ok("publicar", s == 200, r)
s, r = call("POST", f"/stores/{sid}/albums", {"title": "Galería QA", "priceCents": 300000, "status": "published"}, tok); ok("crear galería", s == 201, s)
aid = r["album"]["id"]

photos = []
for i, color in enumerate(["#3b5b7a", "#7a5b3b"]):
    blob = test_image(color)
    body, ct = multipart(blob, f"qa_{i}.jpg")
    s, r = call("POST", f"/stores/{sid}/photos?albumId={aid}&priceCents=120000&status=published", token=tok, raw=body, ctype=ct)
    ok(f"subir foto {i+1}", s == 201, s if s != 201 else "")
    photos.append((r["photo"]["id"], hashlib.sha256(blob).hexdigest(), r["photo"]["thumbUrl"]))

s, r = call("GET", photos[0][2].replace("/api/v1", ""), host=STORE_HOST)
ok("miniatura pública", s == 200 and isinstance(r, bytes) and r[:4] == b"RIFF")
s, r = call("GET", "/public/storefront", host=STORE_HOST)
ok("vitrina pública", s == 200 and r["albums"][0]["photoCount"] == 2, s)

origin = f"https://{STORE_HOST}"
s, r = call("POST", "/public/orders", {"customerName": "Cliente QA", "customerEmail": EMAIL, "items": [{"type":"album","id":aid},{"type":"photo","id":photos[0][0]}]}, host=STORE_HOST, origin=origin)
ok("pedido creado", s == 201 and r["order"]["totalCents"] == 300000, r.get("order", r))
order = r["order"]
dl = f"/public/orders/{order['orderId']}/photos/{photos[0][0]}/download?token={order['accessToken']}"
s, r = call("GET", dl, host=STORE_HOST); ok("descarga bloqueada sin pago", s == 403, s)
s, r = call("POST", f"/stores/{sid}/orders/{order['orderId']}/payments", {"amountCents": 300000, "method": "transfer", "reference": "QA"}, tok)
ok("pago registrado → pagado", s == 200 and r["status"] == "paid", r)
s, r = call("GET", dl, host=STORE_HOST)
ok("descarga del original", s == 200 and hashlib.sha256(r).hexdigest() == photos[0][1])
s, r = call("POST", f"/stores/{sid}/storefront/unpublish", token=tok); ok("vitrina QA ocultada", s == 200, s)
print("SMOKE TEST OK", order["code"])
