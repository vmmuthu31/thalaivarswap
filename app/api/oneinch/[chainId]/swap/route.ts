import { NextResponse, NextRequest } from "next/server";

/**
 * Proxy for 1inch swap API
 *
 * @param request - The incoming request
 * @param context - Contains route parameters including chainId
 * @returns NextResponse with 1inch API response
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ chainId: string }> }
) {
  try {
    const params = await context.params;
    const chainId = params.chainId;

    const apiKey = process.env.NEXT_PUBLIC_ONEINCH_API_KEY;

    const url = new URL(request.url);
    const queryParams = new URLSearchParams(url.search);

    const requiredParams = ["src", "dst", "amount", "from", "slippage"];
    for (const param of requiredParams) {
      if (!queryParams.has(param)) {
        return NextResponse.json(
          { error: `Missing required parameter: ${param}` },
          { status: 400 }
        );
      }
    }

    const src = queryParams.get("src") || "";
    const dst = queryParams.get("dst") || "";

    const WRAPPED_NATIVE_TOKENS: Record<string, string> = {
      "1": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH on Ethereum
      "56": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB on BSC
      "8453": "0x4200000000000000000000000000000000000006", // WETH on Base
    };

    const wrappedNativeToken = WRAPPED_NATIVE_TOKENS[chainId];
    let finalSrc = src;
    let finalDst = dst;

    if (
      wrappedNativeToken &&
      src.toLowerCase() === wrappedNativeToken.toLowerCase()
    ) {
      finalSrc = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    }

    if (
      wrappedNativeToken &&
      dst.toLowerCase() === wrappedNativeToken.toLowerCase()
    ) {
      finalDst = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    }

    const apiParams = new URLSearchParams();

    for (const [key, value] of queryParams.entries()) {
      if (key === "src") {
        apiParams.set(key, finalSrc);
      } else if (key === "dst") {
        apiParams.set(key, finalDst);
      } else {
        apiParams.set(key, value);
      }
    }

    const apiUrl = `https://api.1inch.dev/swap/v6.1/${chainId}/swap`;

    const apiUrlWithParams = `${apiUrl}?${apiParams.toString()}`;

    const response = await fetch(apiUrlWithParams, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    const responseText = await response.text();

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      console.error(
        "Failed to parse 1inch API response as JSON:",
        responseText
      );
      return NextResponse.json(
        {
          error: "1inch API returned invalid JSON",
          details: responseText,
        },
        { status: 500 }
      );
    }

    if (!response.ok) {
      console.error("1inch API error response:", responseData);
      return NextResponse.json(
        {
          error: `1inch API error: ${response.status} ${response.statusText}`,
          details: JSON.stringify(responseData),
        },
        { status: response.status }
      );
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Error in 1inch swap API route:", error);
    return NextResponse.json(
      { error: "Internal server error", details: (error as Error).message },
      { status: 500 }
    );
  }
}
