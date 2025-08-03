import { NextResponse, NextRequest } from "next/server";

/**
 * Proxy for 1inch allowance API
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

    const requiredParams = ["tokenAddress", "walletAddress"];
    for (const param of requiredParams) {
      if (!queryParams.has(param)) {
        return NextResponse.json(
          { error: `Missing required parameter: ${param}` },
          { status: 400 }
        );
      }
    }

    const apiParams = new URLSearchParams();

    for (const [key, value] of queryParams.entries()) {
      apiParams.set(key, value);
    }

    const apiUrl = `https://api.1inch.dev/swap/v6.1/${chainId}/allowance`;

    const apiUrlWithParams = `${apiUrl}?${apiParams.toString()}`;

    const response = await fetch(apiUrlWithParams, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    const responseText = await response.text();

    try {
      const responseData = JSON.parse(responseText);

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
  } catch (error) {
    console.error("Error in 1inch allowance API route:", error);
    return NextResponse.json(
      { error: "Internal server error", details: (error as Error).message },
      { status: 500 }
    );
  }
}
