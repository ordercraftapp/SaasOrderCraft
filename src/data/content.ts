// data/content.ts

import { LucideIcon, ClipboardList, ChefHat, Motorbike, BookOpenText, Search, Zap, DollarSign, Users, MessageSquare } from 'lucide-react';

// --- Type Definitions ---

export interface NavLink {
  name: string;
  href: string;
}

export interface Feature {
  icon: LucideIcon; // Using LucideIcon type for icon component
  title: string;
  description: string;
}

export interface PricingPlan {
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  isPopular: boolean;
}

export interface ProcessStep {
  number: number;
  title: string;
  description: string;
}

export interface Testimonial {
  quote: string;
  name: string;
  title: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

// --- Content Data ---

// --- NAVEGACIÓN ACTUALIZADA ---
export const NAV_LINKS = [
  { name: 'Features', href: '/features' }, // APUNTA a /features/page.tsx
  { name: 'Pricing', href: '/pricing' },   // APUNTA a /pricing/page.tsx
  { name: 'How It Works', href: '/process' }, // APUNTA a /process/page.tsx
  { name: 'Testimonials', href: '/testimonials' }, // APUNTA a /testimonials/page.tsx
  { name: 'FAQ', href: '/faq' },           // APUNTA a /faq/page.tsx
];

export const FEATURES: Feature[] = [
  {
    icon: ChefHat,
    title: 'Kitchen Orders',
    description: 'Real-time order flow that keeps your kitchen fast, organized, and error-free every day.',
  },
  {
    icon: Motorbike,
    title: 'Delivery Control',
    description: 'Manage every delivery with full visibility, from the kitchen to the customer.',
  },
  {
    icon: BookOpenText,
    title: 'Menu Creation',
    description: 'Create, edit, and optimize your menu instantly with smart AI suggestions that sell more.',
  },
  {
    icon: ClipboardList,
    title: 'Reports',
    description: 'Get clear, actionable insights to boost sales, improve service, and grow your restaurant.',
  },
];

export const PROCESS_STEPS: ProcessStep[] = [
  { number: 1, title: 'Set Up Your Space', description: 'Create your restaurant profile, connect your team, and get your workspace ready to go.' },
  { number: 2, title: 'Build & Customize', description: 'Add your menu items, configure orders, delivery, and kitchen tools — all from one dashboard.' },
  { number: 3, title: 'Launch & Grow', description: 'Start taking orders instantly and use reports, marketing, and AI tools to scale your success.' },
];

export const PRICING_PLANS: PricingPlan[] = [
  {
    name: 'Starter',
    description: 'Perfect for small personal websites or blogs getting started.',
    monthlyPrice: 19.99,
    yearlyPrice: 19.99,
    features: ['Kitchen Orders', 'Cashier', 'Menu Creation', 'Admin Roles', 'Taxes', 'Order Mangement', 'Reports: Sales', 'Reports: Taxes', 'Reports: Menu Items'],
    isPopular: false,
  },
  {
    name: 'Pro',
    description: 'Our most popular plan — designed for growing restaurants with higher order volume.',
    monthlyPrice: 29.99,
    yearlyPrice: 29.99,
    features: ['Everything in Starter', 'Tables', 'Edit Orders', 'Create promotions', 'Reports: Clients', 'Reports: Promotions', 'Reports: Kitchen Times'],
    isPopular: true,
  },
  {
    name: 'Full',
    description: 'Powerful hosting solutions built for large agencies and corporations.',
    monthlyPrice: 34.99,
    yearlyPrice: 34.99,
    features: ['Everything in Pro', 'Delivery', 'Delivery Options', 'OPS', 'Tables', 'Marketing Campaigns', 'AI Studio', 'Reports: Delivery', 'Reports: Cashier'],
    isPopular: false,
  },
];

export const TESTIMONIALS: Testimonial[] = [
  {
    quote: "The speed and reliability are unmatched. Our traffic quadrupled, and the site never once slowed down. Highly recommend!",
    name: 'Sarah K.',
    title: 'Startup Founder',
  },
  {
    quote: "The customer support is lightning fast and genuinely helpful. Migration was seamless, and the price is right.",
    name: 'Mark T.',
    title: 'Lead Developer',
  },
  // Add more as needed for a carousel/list
];

export const FAQ_ITEMS: FAQItem[] = [
  {
    question: 'What is your refund policy?',
    answer: 'We offer a risk-free 30-day money-back guarantee on all hosting plans, no questions asked.',
  },
  {
    question: 'Do you offer domain registration?',
    answer: 'Yes, you can register new domains or transfer existing ones directly through our platform.',
  },
  {
    question: 'Which control panel do you use?',
    answer: 'We use a highly customized, intuitive control panel designed for ease of use by both beginners and experts.',
  },
];