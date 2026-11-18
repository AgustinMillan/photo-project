import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../errors/app-error.js";

type ErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      const payload: ErrorPayload = {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      };

      if (error.details !== undefined) {
        payload.error.details = error.details;
      }

      return reply.status(error.statusCode).send(payload);
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request contains invalid data.",
          details: error.issues,
          requestId,
        },
      } satisfies ErrorPayload);
    }

    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request contains invalid data.",
          details: error.validation,
          requestId,
        },
      } satisfies ErrorPayload);
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, "Unhandled request error");
    }

    return reply.status(statusCode).send({
      error: {
        code: statusCode === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
        message:
          statusCode >= 500 ? "An unexpected error occurred." : error.message || "Request failed.",
        requestId,
      },
    } satisfies ErrorPayload);
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "The requested resource was not found.",
        requestId: request.id,
      },
    } satisfies ErrorPayload);
  });
}
