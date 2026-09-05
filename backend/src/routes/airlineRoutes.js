import { Router } from "express";
import Airline from "../models/Airline.js";

const router = Router();

router.get("/", async (_request, response) => {
  const airlines = await Airline.find({ active: true })
    .select("code name -_id")
    .lean();
  airlines.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  response.json({ data: { airlines } });
});

export default router;
