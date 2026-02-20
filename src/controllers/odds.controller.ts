import { Request, Response } from "express";
import axios from "axios";
import { ApiResponse, asyncHandler } from "@/utils";
import { myEnvironment } from "@/configs/env.config";

const ODDS_API_URL = myEnvironment.ODDS_API_URL;
const ODDS_API_KEY = myEnvironment.ODDS_API_KEY;

// ─────────────────────────────────────────────────────────
// GET /api/odds/sports
// ─────────────────────────────────────────────────────────
export const getSports = asyncHandler(async (_req: Request, res: Response) => {
  const response = await axios.get(`${ODDS_API_URL}/sports`, {
    params: { apiKey: ODDS_API_KEY },
  });
  return res
    .status(200)
    .json(new ApiResponse(200, response.data, "Sports fetched successfully"));
});

// ─────────────────────────────────────────────────────────
// GET /api/odds/sports/:sport/odds
// ─────────────────────────────────────────────────────────
export const getOdds = asyncHandler(async (req: Request, res: Response) => {
  const { sport } = req.params;
  const {
    regions = "us",
    markets = "h2h,spreads",
    oddsFormat = "decimal",
    dateFormat = "iso",
  } = req.query;

  const response = await axios.get(`${ODDS_API_URL}/sports/${sport}/odds`, {
    params: { apiKey: ODDS_API_KEY, regions, markets, oddsFormat, dateFormat },
  });

  // Include quota headers
  res.setHeader(
    "x-requests-remaining",
    response.headers["x-requests-remaining"] || "",
  );
  res.setHeader("x-requests-used", response.headers["x-requests-used"] || "");

  return res
    .status(200)
    .json(new ApiResponse(200, response.data, "Odds fetched successfully"));
});

// ─────────────────────────────────────────────────────────
// GET /api/odds/sports/:sport/scores
// ─────────────────────────────────────────────────────────
export const getScores = asyncHandler(async (req: Request, res: Response) => {
  const { sport } = req.params;
  const { daysFrom = 1, dateFormat = "iso" } = req.query;

  const response = await axios.get(`${ODDS_API_URL}/sports/${sport}/scores`, {
    params: { apiKey: ODDS_API_KEY, daysFrom, dateFormat },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, response.data, "Scores fetched successfully"));
});

// ─────────────────────────────────────────────────────────
// GET /api/odds/upcoming
// ─────────────────────────────────────────────────────────
export const getUpcomingOdds = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      regions = "us",
      markets = "h2h",
      oddsFormat = "decimal",
    } = req.query;

    const response = await axios.get(`${ODDS_API_URL}/sports/upcoming/odds`, {
      params: { apiKey: ODDS_API_KEY, regions, markets, oddsFormat },
    });

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          response.data,
          "Upcoming odds fetched successfully",
        ),
      );
  },
);
