"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, BarChart3, Home, Zap } from "lucide-react";

export default function Navigation() {
  const pathname = usePathname();

  const navItems = [
    {
      href: "/",
      label: "Home",
      icon: Home,
      description: "Welcome to ThalaivarSwap",
    },
    {
      href: "/swap",
      label: "Swap",
      icon: ArrowLeftRight,
      description: "Execute cross-chain swaps",
    },
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: BarChart3,
      description: "Monitor swap activity",
    },
  ];

  return (
    <nav className="bg-white/10 backdrop-blur-md border-b border-white/10">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2">
            <Zap className="w-8 h-8 text-yellow-400" />
            <span className="text-white text-xl font-bold">ThalaivarSwap</span>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "text-gray-300 hover:text-white hover:bg-white/10"
                  }`}
                  title={item.description}
                >
                  <Icon className="w-4 h-4" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Status Indicator */}
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-green-400 text-sm font-medium">Live</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
