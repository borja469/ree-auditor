import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

type QueryProfile = {
  count: number;
  totalMs: number;
  byModel: Record<string, { count: number; totalMs: number }>;
  slowest: Array<{ query: string; durationMs: number }>;
};

let activeQueryProfile: QueryProfile | null = null;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super(queryProfilingEnabled() ? { log: [{ emit: "event", level: "query" }] } : undefined);
    if (queryProfilingEnabled()) {
      this.$on("query" as never, (event: { query?: string; duration?: number }) => {
        const profile = activeQueryProfile;
        if (!profile) return;
        const durationMs = Number(event.duration ?? 0);
        const query = event.query ?? "";
        const model = classifyQuery(query);
        profile.count += 1;
        profile.totalMs += durationMs;
        profile.byModel[model] ??= { count: 0, totalMs: 0 };
        profile.byModel[model].count += 1;
        profile.byModel[model].totalMs += durationMs;
        profile.slowest.push({ query: compactQuery(query), durationMs });
        profile.slowest.sort((left, right) => right.durationMs - left.durationMs);
        profile.slowest = profile.slowest.slice(0, 10);
      });
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async profileQueries<T>(callback: () => Promise<T>): Promise<{ result: T; profile: QueryProfile }> {
    const profile: QueryProfile = { count: 0, totalMs: 0, byModel: {}, slowest: [] };
    const previous = activeQueryProfile;
    activeQueryProfile = profile;
    try {
      const result = await callback();
      return { result, profile };
    } finally {
      activeQueryProfile = previous;
    }
  }
}

function classifyQuery(query: string) {
  const match = query.match(/\b(?:FROM|INTO|UPDATE)\s+(?:"[a-zA-Z0-9_]+"\.)?"?([a-zA-Z0-9_]+)"?/i);
  return match?.[1] ?? "unknown";
}

function compactQuery(query: string) {
  return query.replace(/\s+/g, " ").trim().slice(0, 500);
}

function queryProfilingEnabled() {
  return process.env.BILLING_JOB_PROFILE === "true";
}
