import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config";
import { router } from "./routes";

const app = express();

app.use(
  cors({
    origin: config.WEB_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use("/api", router);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({
    error: error instanceof Error ? error.message : "Unexpected server error.",
  });
});

app.listen(config.API_PORT, () => {
  console.log(`Pricechecker API listening on http://localhost:${config.API_PORT}`);
});
