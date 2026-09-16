import crypto from "node:crypto";
import { ADMIN_ERROR_CODES, ApiError } from "../errors/api-error.js";

export function requestId(req, res, next) {
  const incoming = String(req.get("x-request-id") || "").trim();
  req.requestId = incoming && incoming.length <= 128 ? incoming : `req_${crypto.randomUUID()}`;
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

function normalizeError(error) {
  if (error instanceof ApiError) return error;

  if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 499) {
    return new ApiError(error.statusCode, error.code || ADMIN_ERROR_CODES.INVALID_REQUEST, error.message || "The request could not be completed.", error.details);
  }

  if (error?.code === 11000) {
    return new ApiError(409, ADMIN_ERROR_CODES.INVALID_REQUEST, "A conflicting record already exists.");
  }

  if (error?.name === "ValidationError" || error?.name === "CastError") {
    return new ApiError(400, ADMIN_ERROR_CODES.INVALID_REQUEST, "The request contains invalid data.");
  }

  if (error?.name === "MongoNetworkError" || error?.name === "MongoServerSelectionError") {
    return new ApiError(503, ADMIN_ERROR_CODES.DATABASE_UNAVAILABLE, "The rewards database is temporarily unavailable.");
  }

  return new ApiError(500, ADMIN_ERROR_CODES.INTERNAL_ERROR, "An unexpected error occurred.");
}

export function errorHandler(error, req, res, _next) {
  const normalized = normalizeError(error);
  const status = normalized.statusCode >= 400 && normalized.statusCode <= 599 ? normalized.statusCode : 500;
  const internal = status >= 500 && normalized.code === ADMIN_ERROR_CODES.INTERNAL_ERROR;

  console.error("[Rewards API Error]", {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    shop: req.shopifySession?.shop || req.customerSession?.shop,
    actorId: req.shopifySession?.subject || req.customerSession?.shopifyCustomerId,
    status,
    code: normalized.code,
    message: error?.message,
    stack: error?.stack,
  });

  const body = {
    error: {
      code: internal ? ADMIN_ERROR_CODES.INTERNAL_ERROR : normalized.code,
      message: internal ? "An unexpected error occurred." : normalized.message,
    },
    meta: {
      requestId: req.requestId || `req_${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
    },
  };

  if (!internal && normalized.details !== undefined) body.error.details = normalized.details;
  res.status(status).json(body);
}
