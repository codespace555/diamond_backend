// src/services/odds-polling.service.ts
//
// Polls The Odds API every 15 seconds and stores reference odds
// in the ReferenceOdds table.  These prices are for display only
// — matching uses the user's own submitted price.

import { prisma } from "@/configs";
import { myEnvironment } from "@/configs/env.config";
import axios from "axios";

const ODDS_API_KEY = myEnvironment.ODDS_API_KEY;
const ODDS_API_BASE = myEnvironment.ODDS_API_URL;
const POLL_INTERVAL_MS = 15_000;

// Only poll sports that the platform currently supports
const ACTIVE_SPORTS = [
  "soccer_epl",
  "soccer_uefa_champs_league",
  "basketball_nba",
  "cricket_test_match",
  "tennis_atp_french_open",
];

interface OddsApiOutcome {
  name: string;
  price: number; // decimal odds
}

interface OddsApiBookmaker {
  key: string;
  markets: {
    key: string;
    outcomes: OddsApiOutcome[];
  }[];
}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export class OddsPollingService {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(): void {
    console.log(
      `[OddsPollingService] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`,
    );
    this.intervalId = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    this.poll(); // immediate first run
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async poll(): Promise<void> {
    for (const sport of ACTIVE_SPORTS) {
      try {
        await this.pollSport(sport);
      } catch (err) {
        console.warn(
          `[OddsPollingService] Failed to poll sport ${sport}:`,
          err,
        );
      }
    }
  }

  private async pollSport(sport: string): Promise<void> {
    const res = await axios.get<OddsApiEvent[]>(
      `${ODDS_API_BASE}/sports/${sport}/odds/`,
      {
        params: {
          apiKey: ODDS_API_KEY,
          regions: "uk",
          markets: "h2h",
          oddsFormat: "decimal",
        },
        timeout: 8000,
      },
    );

    const events = res.data;

    for (const event of events) {
      // Find the corresponding Match in our DB via externalId
      const match = await prisma.match.findUnique({
        where: { externalId: event.id },
        include: {
          markets: {
            include: { runners: true },
          },
        },
      });

      if (!match || match.markets.length === 0) continue;

      // Use the first bookmaker's h2h market as reference
      const bookmaker = event.bookmakers[0];
      if (!bookmaker) continue;

      const h2hMarket = bookmaker.markets.find((m) => m.key === "h2h");
      if (!h2hMarket) continue;

      // For each market (typically the Match Odds market)
      for (const market of match.markets) {
        for (const outcome of h2hMarket.outcomes) {
          const runner = market.runners.find(
            (s) => s.name.toLowerCase() === outcome.name.toLowerCase(),
          );

          if (!runner) continue;

          const backPrice = outcome.price;
          // Approximate lay price: back + a small spread (0.02)
          const layPrice = Math.max(backPrice - 0.02, 1.01);

          await prisma.referenceOdds.upsert({
            where: {
              marketId_selectionId: {
                marketId: market.id,
                selectionId: runner.id,
              },
            },
            create: {
              marketId: market.id,
              selectionId: runner.id,
              referenceBackPrice: backPrice,
              referenceLayPrice: layPrice,
            },
            update: {
              referenceBackPrice: backPrice,
              referenceLayPrice: layPrice,
              lastUpdated: new Date(),
            },
          });
        }
      }
    }

    console.log(
      `[OddsPollingService] Updated reference odds for ${events.length} ${sport} events`,
    );
  }
}

export const oddsPollingService = new OddsPollingService();
