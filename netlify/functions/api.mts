// Единая точка входа API CRM W2W: все запросы /api/* попадают сюда, маршруты — в netlify/lib/routes.mts.
import type { Config, Context } from "@netlify/functions";
import { handle } from "../lib/routes.mts";

export default async (req: Request, context: Context) => handle(req, context?.ip || "");

export const config: Config = { path: "/api/*" };
