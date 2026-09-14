import type { NextFunction, Request, Response } from "express";

export interface FieldRule {
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  allowedValues?: readonly string[];
}

export type ValidationSchema = Record<string, FieldRule>;

export function validateSchema(schema: ValidationSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];
    const body = req.body ?? {};

    for (const [field, rule] of Object.entries(schema)) {
      const value = body[field];

      if (rule.required && (value === undefined || value === null)) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value === undefined || value === null) continue;

      if (rule.type === "string" && typeof value !== "string") {
        errors.push(`${field} must be a string`);
      }
      if (rule.type === "number" && typeof value !== "number") {
        errors.push(`${field} must be a number`);
      }
      if (rule.type === "boolean" && typeof value !== "boolean") {
        errors.push(`${field} must be a boolean`);
      }

      if (typeof value === "string") {
        if (rule.minLength && value.length < rule.minLength) {
          errors.push(`${field} must be at least ${rule.minLength} characters`);
        }
        if (rule.maxLength && value.length > rule.maxLength) {
          errors.push(`${field} must be at most ${rule.maxLength} characters`);
        }
        if (rule.pattern && !rule.pattern.test(value)) {
          errors.push(`${field} format is invalid`);
        }
      }

      if (typeof value === "number") {
        if (rule.min !== undefined && value < rule.min) {
          errors.push(`${field} must be >= ${rule.min}`);
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push(`${field} must be <= ${rule.max}`);
        }
      }

      if (rule.allowedValues && !rule.allowedValues.includes(value)) {
        errors.push(`${field} must be one of: ${rule.allowedValues.join(", ")}`);
      }
    }

    if (errors.length > 0) {
      res.status(400).json({ error: "invalid_request", errors });
      return;
    }

    next();
  };
}
