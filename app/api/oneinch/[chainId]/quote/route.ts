import { NextResponse, NextRequest } from "next/server";

/**
 * Proxy for 1inch quote API
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

    const { searchParams } = new URL(request.url);

    const requiredParams = ["src", "dst", "amount"];
    for (const param of requiredParams) {
      if (!searchParams.has(param)) {
        return NextResponse.json(
          { error: `Missing required parameter: ${param}` },
          { status: 400 }
        );
      }
    }

    const apiUrl = `https://api.1inch.dev/swap/v6.1/${chainId}/quote`;

    const apiUrlWithParams = `${apiUrl}?${searchParams.toString()}`;

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
    console.error("Error in 1inch quote API route:", error);
    return NextResponse.json(
      { error: "Internal server error", details: (error as Error).message },
      { status: 500 }
    );
  }
}
