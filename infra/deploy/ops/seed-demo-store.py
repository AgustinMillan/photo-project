#!/usr/bin/env python3
"""Builds the public showcase store (ejemplo.<DOMAIN>) with CC0 photos.

Run on the server from infra/deploy, with the .env loaded:
  set -a; . ./.env; set +a; DOMAIN=galeriza.com.ar python3 ops/seed-demo-store.py

Idempotent enough to re-run: it reuses the account and store, and only uploads
photos into galleries that are still empty. Photos come from Wikimedia Commons
and are checked to be CC0 / public domain before use. The store slug must be
listed in DEMO_STORE_SLUGS so it never takes real orders.
"""

import json
import os
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

DOMAIN = os.environ["DOMAIN"]
API = os.environ.get("API", "http://127.0.0.1:3100/api/v1")
SLUG = "ejemplo"
EMAIL = os.environ.get("DEMO_EMAIL", f"demo@{DOMAIN}")
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
UA = {"User-Agent": f"GalerizaDemo/1.0 (https://{DOMAIN})"}

GALLERIES = [
    {
        "title": "Montañas y lagos",
        "description": "Paisajes de alta montaña: lagos glaciares, bosques y nieve. Fotos en alta resolución para imprimir o decorar.",
        "price": 2_000_000,
        "photo_price": 350_000,
        "photos": [
            ("Lago turquesa entre montañas", "File:Azure lake in the tall mountains (Unsplash).jpg"),
            ("Reflejo de nubes en el lago", "File:Clouds mirrored in a mountain lake (Unsplash).jpg"),
            ("Laguna entre picos nevados", "File:Clear lake in snowy mountains (Unsplash).jpg"),
            ("Lago esmeralda", "File:Boat on Lake Louise (Unsplash).jpg"),
            ("Bosque nevado en la ladera", "File:Above the frozen forest (Unsplash).jpg"),
            ("Copas doradas de otoño", "File:Autumn forest canopy (Unsplash).jpg"),
            ("Arroyo con cascada", "File:Blue stream with a waterfall (Unsplash).jpg"),
            ("Mar de nubes sobre el bosque", "File:Cloud on forest mountain (Unsplash).jpg"),
        ],
    },
    {
        "title": "Café de especialidad",
        "description": "Sesión de producto para una cafetería: tazas, preparación y mesas de desayuno.",
        "price": 1_500_000,
        "photo_price": 300_000,
        "photos": [
            ("Capuchino en taza negra", "File:Black coffee cup (Unsplash).jpg"),
            ("Latte art en taza azul", "File:Blue coffee cup (Unsplash).jpg"),
            ("Escritorio con café y cámara", "File:Camera, coaster and coffee in flatlay (Unsplash).jpg"),
            ("Mesa de trabajo creativa", "File:Artistic flatlay (Unsplash).jpg"),
            ("Scones de arándanos y flores", "File:Blueberry scones with flowers (Unsplash).jpg"),
            ("Desayuno con panqueques", "File:Breakfast table with pancakes (Unsplash).jpg"),
        ],
    },
    {
        "title": "Flores de cerca",
        "description": "Macro de jardín: abejas, mariposas y flores silvestres con luz natural.",
        "price": 1_500_000,
        "photo_price": 250_000,
        "photos": [
            ("Abeja sobre girasol", "File:Bee on orange flower in macro (Unsplash).jpg"),
            ("Mariposa en flor naranja", "File:Black butterfly on red flower (Unsplash).jpg"),
            ("Amapola blanca", "File:Blooming white flower (Unsplash).jpg"),
            ("Mariposa en flores lilas", "File:Beige butterfly on tiny flowers (Unsplash).jpg"),
            ("Campo de margaritas amarillas", "File:Black-eyed Susan flowers in a meadow (Unsplash).jpg"),
            ("Abeja en flores de cerezo", "File:Bee with flower in action (Unsplash).jpg"),
        ],
    },
]
COVER = "Lago turquesa entre montañas"


def call(method, path, body=None, token=None, raw=None, ctype=None):
    headers = {"Host": DOMAIN}
    data = None
    if raw is not None:
        data, headers["Content-Type"] = raw, ctype
    elif body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            text = response.read()
            return response.status, (json.loads(text) if text else {})
    except urllib.error.HTTPError as error:
        text = error.read()
        try:
            return error.code, json.loads(text)
        except ValueError:
            return error.code, {"raw": text.decode(errors="replace")}


def admin(*args):
    subprocess.run(
        ["docker", "compose", "exec", "-T", "api", "node", "dist/admin/cli.js", *args],
        check=False,
        capture_output=True,
    )


def demo_password():
    password = os.environ.get("DEMO_PASSWORD")
    if password:
        return password
    password = secrets.token_urlsafe(24)
    with open(ENV_FILE, "a", encoding="utf-8") as env:
        env.write(f"DEMO_PASSWORD={password}\n")
    return password


def commons(titles):
    params = {
        "action": "query",
        "format": "json",
        "titles": "|".join(titles),
        "prop": "imageinfo",
        "iiprop": "url|extmetadata",
        "iiurlwidth": "2400",
    }
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as response:
        pages = json.load(response)["query"]["pages"].values()
    result = {}
    for page in pages:
        info = page["imageinfo"][0]
        license_name = info["extmetadata"].get("LicenseShortName", {}).get("value", "")
        if not (license_name.upper().startswith("CC0") or "public domain" in license_name.lower()):
            sys.exit(f"{page['title']} is not CC0/public domain ({license_name}); refusing to use it.")
        result[page["title"]] = info["thumburl"]
    return result


def multipart(blob, filename):
    boundary = uuid.uuid4().hex
    head = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        "Content-Type: image/jpeg\r\n\r\n"
    ).encode()
    return head + blob + f"\r\n--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def slugify(text):
    keep = "abcdefghijklmnopqrstuvwxyz0123456789"
    table = str.maketrans("áéíóúñü", "aeiounu")
    return "".join(c if c in keep else "-" for c in text.lower().translate(table)).strip("-")


def main():
    password = demo_password()
    status, _ = call("POST", "/auth/register", {"email": EMAIL, "password": password, "displayName": "Estudio Andes"})
    print("registro", status)
    admin("verify-email", EMAIL)
    status, login = call("POST", "/auth/login", {"email": EMAIL, "password": password})
    if status != 200:
        sys.exit(f"login failed: {status} {login}")
    token = login["accessToken"]
    call("POST", "/accounts", {"name": "Estudio Andes"}, token)
    status, stores = call("GET", "/stores", token=token)
    store = next((s for s in stores.get("stores", []) if s.get("slug") == SLUG), None)
    if not store:
        status, created = call("POST", "/stores", {"name": "Estudio Andes", "slug": SLUG}, token)
        if status != 201:
            sys.exit(f"store failed: {status} {created}")
        store = created["store"]
    store_id = store["id"]
    admin("pilot:start", EMAIL, "--note", "tienda de ejemplo pública")
    print("tienda", store_id)

    status, existing = call("GET", f"/stores/{store_id}/albums", token=token)
    albums_by_title = {a["title"]: a for a in existing.get("albums", [])} if status == 200 else {}
    urls = commons([title for gallery in GALLERIES for _, title in gallery["photos"]])
    photo_ids = {}

    for gallery in GALLERIES:
        album = albums_by_title.get(gallery["title"])
        if not album:
            status, created = call(
                "POST",
                f"/stores/{store_id}/albums",
                {
                    "title": gallery["title"],
                    "description": gallery["description"],
                    "priceCents": gallery["price"],
                    "status": "published",
                },
                token,
            )
            if status != 201:
                sys.exit(f"album failed: {status} {created}")
            album = created["album"]
        if album.get("photoCount"):
            print("galería ya cargada:", gallery["title"])
            status, listing = call("GET", f"/stores/{store_id}/photos?albumId={album['id']}", token=token)
            for photo in listing.get("photos", []):
                photo_ids[photo["title"]] = photo["id"]
            continue
        for name, title in gallery["photos"]:
            with urllib.request.urlopen(urllib.request.Request(urls[title], headers=UA), timeout=120) as response:
                blob = response.read()
            body, ctype = multipart(blob, f"{slugify(name)}.jpg")
            query = urllib.parse.urlencode(
                {"albumId": album["id"], "priceCents": gallery["photo_price"], "status": "published"}
            )
            status, uploaded = call("POST", f"/stores/{store_id}/photos?{query}", token=token, raw=body, ctype=ctype)
            if status != 201:
                sys.exit(f"upload failed for {name}: {status} {uploaded}")
            photo_id = uploaded["photo"]["id"]
            call("PATCH", f"/stores/{store_id}/photos/{photo_id}", {"title": name}, token)
            photo_ids[name] = photo_id
            print("  foto", name)

    cover = photo_ids.get(COVER)
    services = [
        {
            "id": str(uuid.uuid4()),
            "title": "Fotografía de producto",
            "description": "Fotos para tu tienda online, carta o redes: fondo neutro o ambientadas, editadas y listas para publicar.",
            "priceFromCents": 6_000_000,
            "coverPhotoId": photo_ids.get("Latte art en taza azul"),
        },
        {
            "id": str(uuid.uuid4()),
            "title": "Sesión de paisaje a pedido",
            "description": "Salida fotográfica a la locación que elijas, con entrega de 20 fotos en alta resolución.",
            "priceFromCents": 9_000_000,
            "coverPhotoId": photo_ids.get("Reflejo de nubes en el lago"),
        },
        {
            "id": str(uuid.uuid4()),
            "title": "Cuadros e impresiones",
            "description": "Cualquier foto de la tienda impresa en papel fotográfico o canvas, en el tamaño que necesites.",
            "priceFromCents": None,
            "coverPhotoId": photo_ids.get("Copas doradas de otoño"),
        },
    ]
    status, draft = call("GET", f"/stores/{store_id}/storefront", token=token)
    sections = [{"key": s["key"], "enabled": True} for s in draft.get("draft", {}).get("sections", [])] or [
        {"key": key, "enabled": True} for key in ["hero", "services", "albums", "about", "contact"]
    ]
    content = {
        "displayName": "Estudio Andes",
        "tagline": "Paisaje, producto y naturaleza de cerca",
        "bio": (
            "Somos un estudio de fotografía de paisaje y producto. En esta tienda podés ver nuestras "
            "galerías, comprar fotos sueltas o la galería completa, y consultar por sesiones a medida.\n\n"
            "Esta es una tienda de ejemplo de Galeriza: así se ve la tuya cuando subís tus fotos."
        ),
        "contactEmail": os.environ.get("SUPPORT_EMAIL", ""),
        "phone": "",
        "instagram": "",
        "website": "",
        "coverPhotoId": cover,
        "paymentInstructions": "",
        "watermarkText": "GALERIZA · EJEMPLO",
        "services": services,
        "sections": sections,
    }
    status, saved = call("PUT", f"/stores/{store_id}/storefront", content, token)
    print("vitrina", status, "" if status == 200 else saved)
    status, published = call("POST", f"/stores/{store_id}/storefront/publish", token=token)
    print("publicada", status)


if __name__ == "__main__":
    main()
