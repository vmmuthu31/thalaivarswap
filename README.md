# Thalaivar Swap DApp

A comprehensive Web3 decentralized application built with Next.js, featuring secure wallet management via Turnkey's MPC technology, portfolio tracking, token swapping, and AI-powered portfolio assistance.

## Features

### ✅ Core Features

- **Secure Wallet Connection**: Turnkey MPC (Multi-Party Computation) for enhanced security
- **Portfolio Management**: View token balances, prices, and 24h changes
- **Token Swapping**: Intent-based UI with DEX aggregation via 0x Protocol
- **Transaction Signing**: Secure backend signing via Turnkey SDK
- **Portfolio Analytics**: Interactive charts and asset allocation visualization
- **AI Assistant**: OpenAI-powered portfolio analysis and trading advice

### 🔐 Security Features

- MPC key management (no single point of failure)
- Server-side transaction signing
- Secure API key management
- Session-based authentication support

### 📊 Analytics & Insights

- Real-time portfolio value tracking
- Asset allocation pie charts
- Historical performance graphs
- Price impact and slippage estimation

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, TailwindCSS
- **Web3**: Wagmi, Viem, Ethers.js
- **Security**: Turnkey SDK (Browser & Server)
- **Charts**: Recharts
- **AI**: OpenAI GPT-3.5
- **DEX Integration**: 0x Protocol API
- **Deployment**: Vercel-ready

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo>
cd web3-portfolio-dapp
npm install
```

### 2. Environment Setup

Copy `.env.example` to `.env.local` and configure:

```bash
cp .env.example .env.local
```

Required environment variables:

```env
# Turnkey Configuration
NEXT_PUBLIC_TURNKEY_API_BASE_URL=https://api.turnkey.com
NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID=your_organization_id
TURNKEY_API_PRIVATE_KEY=your_api_private_key
TURNKEY_API_PUBLIC_KEY=your_api_public_key

# OpenAI (Optional)
OPENAI_API_KEY=your_openai_api_key

# DEX Aggregator
NEXT_PUBLIC_0X_API_KEY=your_0x_api_key
```

### 3. Turnkey Setup

1. **Create Turnkey Account**: Visit [Turnkey Dashboard](https://app.turnkey.com)
2. **Create Organization**: Set up your organization
3. **Generate API Keys**: Create API key pair for server-side operations
4. **Configure Policies**: Set up signing policies for your use case

### 4. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000` to see your DApp.

## Configuration Guide

### Turnkey Integration

The app uses Turnkey's dual SDK approach:

- **Browser SDK**: For user authentication and wallet creation
- **Server SDK**: For secure transaction signing

Key files:

- `contexts/TurnkeyContext.tsx` - Browser-side integration
- `app/api/turnkey/sign/route.ts` - Server-side signing

### DEX Integration

Currently integrated with 0x Protocol for:

- Price quotes
- Swap execution
- Gas estimation
- Route optimization

To switch to 1inch, modify `app/api/swap/quote/route.ts`.

### AI Assistant

Uses OpenAI GPT-3.5 for:

- Portfolio analysis
- Trading recommendations
- DeFi strategy advice
- Market insights

## Project Structure

```
├── app/
│   ├── api/                 # API routes
│   │   ├── ai-assistant/    # OpenAI integration
│   │   ├── portfolio/       # Portfolio data
│   │   ├── swap/           # DEX quotes
│   │   └── turnkey/        # Transaction signing
│   ├── globals.css         # Global styles
│   ├── layout.tsx          # Root layout
│   ├── page.tsx           # Main app page
│   └── providers.tsx       # Context providers
├── components/             # React components
│   ├── AIAssistant.tsx    # AI chat interface
│   ├── Portfolio.tsx      # Portfolio overview
│   ├── PortfolioChart.tsx # Analytics charts
│   ├── SwapInterface.tsx  # Token swapping
│   └── WalletConnection.tsx # Wallet connection
├── contexts/              # React contexts
│   └── TurnkeyContext.tsx # Turnkey integration
└── lib/                   # Utilities
    └── wagmi.ts          # Wagmi configuration
```

## Deployment

### Vercel Deployment

1. **Connect Repository**: Link your GitHub repo to Vercel
2. **Environment Variables**: Add all required env vars in Vercel dashboard
3. **Deploy**: Automatic deployment on push to main branch

### Environment Variables for Production

Ensure all environment variables are set in your deployment platform:

- Turnkey API credentials
- OpenAI API key (optional)
- 0x API key for DEX integration

## Usage Guide

### Connecting Wallet

1. Click "Connect with Turnkey"
2. Complete WebAuthn authentication
3. Your wallet address will be displayed

### Viewing Portfolio

- Navigate to "Portfolio" tab
- View token balances and values
- See 24h price changes
- Monitor total portfolio value

### Swapping Tokens

1. Go to "Swap" tab
2. Select tokens and enter amount
3. Review quote details (price impact, gas fees)
4. Confirm and execute swap

### Using AI Assistant

1. Navigate to "AI Assistant" tab
2. Ask questions about your portfolio
3. Get trading recommendations
4. Receive DeFi strategy advice

## Security Considerations

### Turnkey MPC Benefits

- **No Single Point of Failure**: Keys are distributed across multiple parties
- **Enhanced Security**: MPC eliminates private key exposure
- **Regulatory Compliance**: Meets institutional security standards

### Best Practices

- Never expose private keys in frontend code
- Use server-side signing for all transactions
- Implement proper session management
- Regular security audits

## Customization

### Adding New Tokens

Modify token lists in:

- `components/Portfolio.tsx`
- `components/SwapInterface.tsx`

### Integrating Additional DEXs

1. Add new API routes in `app/api/swap/`
2. Update quote fetching logic
3. Modify swap execution flow

### Extending AI Capabilities

Enhance the AI assistant by:

- Adding more context about user behavior
- Implementing conversation memory
- Adding specialized DeFi knowledge

## Troubleshooting

### Common Issues

1. **Turnkey Connection Failed**

   - Verify API credentials
   - Check organization ID
   - Ensure WebAuthn is supported

2. **Swap Quotes Not Loading**

   - Verify 0x API key
   - Check network connectivity
   - Review API rate limits

3. **AI Assistant Not Responding**
   - Confirm OpenAI API key
   - Check API usage limits
   - Review error logs

### Debug Mode

Enable debug logging by setting:

```env
NEXT_PUBLIC_DEBUG=true
```

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:

- Create an issue in the repository
- Check Turnkey documentation: [docs.turnkey.com](https://docs.turnkey.com)
- Review 0x Protocol docs: [docs.0x.org](https://docs.0x.org)

---

Built with ❤️ using Turnkey's secure MPC technology
