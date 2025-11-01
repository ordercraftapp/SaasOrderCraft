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
    description: 'Ideal for small restaurants or cafes getting started with order and kitchen management.',
    monthlyPrice: 19.99,
    yearlyPrice: 19.99,
    features: ['Kitchen Orders', 'Cashier', 'Menu Creation', 'Admin Roles', 'Taxes', 'Order Mangement', 'Reports: Sales', 'Reports: Taxes', 'Reports: Menu Items'],
    isPopular: false,
  },
  {
    name: 'Pro',
    description: 'Our most popular plan — designed for growing restaurants with higher order volume.Perfect for restaurants ready to expand their operations smoothly. ',
    monthlyPrice: 29.99,
    yearlyPrice: 29.99,
    features: ['Everything in Starter', 'Tables', 'Edit Orders', 'Create promotions', 'Reports: Clients', 'Reports: Promotions', 'Reports: Kitchen Times'],
    isPopular: true,
  },
  {
    name: 'Full',
    description: 'Advanced solution for restaurants or high-volume operations ready to scale.',
    monthlyPrice: 34.99,
    yearlyPrice: 34.99,
    features: ['Everything in Pro', 'Delivery', 'Delivery Options', 'OPS', 'Tables', 'Marketing Campaigns', 'AI Studio', 'Reports: Delivery', 'Reports: Cashier'],
    isPopular: false,
  },
];

export const TESTIMONIALS: Testimonial[] = [
  {
    quote: "OrderCraft transformed how we run La Casa del Sabor. Orders flow smoothly, the team is more organized, and we’ve seen our revenue grow in just weeks. It’s like having an extra manager in the kitchen!",
    name: 'Maria López',
    title: 'Mexico',
  },
  {
    quote: "Thanks to OrderCraft, The Green Fork runs more efficiently than ever. Managing orders, tables, and deliveries is effortless, and our staff actually enjoys using the system!",
    name: 'James O’Connor.',
    title: 'Ireland',
  },
  // Add more as needed for a carousel/list
];

export const FAQ_ITEMS: FAQItem[] = [
  {
    question: 'How do I build my menu?',
    answer: 'You can create your menu by organizing items into Main Categories and Subcategories. Add option groups and add-ons, and set rules for how many selections a customer can make for each item.',
  },
  {
    question: 'How are kitchen orders managed?',
    answer: 'When a customer places an order, it appears instantly on the kitchen screen. You can update the order status from “Placed” to “Kitchen Ready,” and the system automatically continues the workflow for dine-in, pickup, or delivery.',
  },
  {
    question: 'How does delivery work?',
    answer: 'Once an order reaches Kitchen Ready, it moves into the delivery workflow. The delivery person picks up the order, assigns themselves, and completes the delivery. In the client portal, the status updates from Assigned to Delivered, and the customer receives a confirmation email once the order is completed.',
  },
  {
    question: 'What is included on the client side?',
    answer: `All plans give customers access to a client portal where they can:
- View the menu and place orders.
- Track orders from “Received” to “Delivered.”
- See a history of past orders.
- Save a home or office address for faster ordering.

With Pro or Full plans, customers can also:
- View available promotions and discounts.`,
  },
];