import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import { encodeDeployData, isAddress } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const feeRecipient = url.searchParams.get("feeRecipient") ?? "";
  if (!isAddress(feeRecipient) || /^0x0{40}$/i.test(feeRecipient)) {
    return NextResponse.json(
      { error: "invalid_fee_recipient" },
      { status: 400 },
    );
  }
  try {
    const artifact = JSON.parse(
      await readFile(
        path.resolve(
          process.cwd(),
          "../smart-wallet-contracts/artifacts/contracts/HubPhysicalEscrow.sol/HubPhysicalEscrow.json",
        ),
        "utf8",
      ),
    ) as { abi?: unknown; bytecode?: unknown };
    if (
      !Array.isArray(artifact.abi) ||
      typeof artifact.bytecode !== "string" ||
      !/^0x[0-9a-f]+$/i.test(artifact.bytecode)
    ) {
      throw new Error("invalid_artifact");
    }
    const deploymentData = encodeDeployData({
      abi: artifact.abi,
      bytecode: artifact.bytecode as `0x${string}`,
      args: [feeRecipient],
    });
    return NextResponse.json(
      { chainId: 80002, version: 6, deploymentData, feeRecipient, feeBps: 100 },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "deployment_artifact_unavailable" },
      { status: 503 },
    );
  }
}
