import { z } from "zod";

export const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export const MfaLoginSchema = z.object({ mfaToken: z.string().min(1), code: z.string().min(6).max(6) });
export const MfaEnableSchema = z.object({ code: z.string().min(6).max(6) });
export const MfaDisableSchema = z.object({ password: z.string().min(1), code: z.string().min(6).max(6) });
