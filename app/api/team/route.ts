import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/db";
import {
  createTeam,
  readTeam,
  addToTeam,
  removeFromTeam,
  cleanArticle,
  cleanName,
} from "@/lib/team";
import { isValidCode } from "@/lib/sync-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notConfigured() {
  return NextResponse.json(
    { error: "Team feeds are not set up on this deployment yet." },
    { status: 503 },
  );
}

const notFound = () =>
  NextResponse.json({ error: "No team feed found for that code." }, { status: 404 });

const badCode = () =>
  NextResponse.json({ error: "That code is not valid." }, { status: 400 });

/** Everything on a team feed, for whoever holds the code. */
export async function GET(request: Request) {
  if (!isConfigured()) return notConfigured();

  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!isValidCode(code)) return badCode();

  try {
    const record = await readTeam(code);
    return record ? NextResponse.json(record) : notFound();
  } catch {
    return NextResponse.json({ error: "Could not reach team storage." }, { status: 502 });
  }
}

/** Start a team feed and get the code to hand out. */
export async function POST(request: Request) {
  if (!isConfigured()) return notConfigured();

  let name = "";
  try {
    name = cleanName(((await request.json()) as { name?: unknown })?.name);
  } catch {
    name = cleanName(null);
  }

  try {
    return NextResponse.json(await createTeam(name));
  } catch {
    return NextResponse.json(
      { error: "Could not create a team feed." },
      { status: 502 },
    );
  }
}

/**
 * Share one article. Only the article travels: the request carries no feeds,
 * no read state and nothing identifying who sent it.
 */
export async function PUT(request: Request) {
  if (!isConfigured()) return notConfigured();

  let body: { code?: string; article?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const code = body.code ?? "";
  if (!isValidCode(code)) return badCode();

  const article = cleanArticle(body.article);
  if (!article) {
    return NextResponse.json(
      { error: "That article cannot be shared." },
      { status: 400 },
    );
  }

  try {
    const record = await addToTeam(code, article);
    return record ? NextResponse.json(record) : notFound();
  } catch {
    return NextResponse.json({ error: "Could not reach team storage." }, { status: 502 });
  }
}

/** Take an article off the shared list. */
export async function DELETE(request: Request) {
  if (!isConfigured()) return notConfigured();

  const params = new URL(request.url).searchParams;
  const code = params.get("code") ?? "";
  const link = params.get("link") ?? "";
  if (!isValidCode(code)) return badCode();
  if (!link) {
    return NextResponse.json({ error: "Expected an article link." }, { status: 400 });
  }

  try {
    const record = await removeFromTeam(code, link);
    return record ? NextResponse.json(record) : notFound();
  } catch {
    return NextResponse.json({ error: "Could not reach team storage." }, { status: 502 });
  }
}
