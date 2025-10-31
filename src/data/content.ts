// data/content.ts

import { LucideIcon, Rocket, Server, Shield, Clock, Search, Zap, DollarSign, Users, MessageSquare } from 'lucide-react';

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

export const NAV_LINKS: NavLink[] = [
  { name: 'Features', href: '#features' },
  { name: 'Pricing', href: '#pricing' },
  { name: 'How It Works', href: '#process' },
  { name: 'Testimonials', href: '#testimonials' },
  { name: 'FAQ', href: '#faq' },
];

export const FEATURES: Feature[] = [
  {
    icon: Server,
    title: 'High-Speed Servers',
    description: 'Blazing fast load times with SSD storage and optimized caching for peak performance.',
  },
  {
    icon: Shield,
    title: 'Advanced Security',
    description: 'DDoS protection, free SSL, and daily malware scans keep your data safe and sound.',
  },
  {
    icon: Clock,
    title: '99.9% Uptime',
    description: 'Guaranteed network stability ensures your website is always accessible to your visitors.',
  },
  {
    icon: Rocket,
    title: 'One-Click Deploy',
    description: 'Install popular apps like WordPress, Drupal, or Joomla with a single click.',
  },
];

export const PROCESS_STEPS: ProcessStep[] = [
  { number: 1, title: 'Search & Select', description: 'Find the perfect domain name and hosting plan for your project.' },
  { number: 2, title: 'Setup & Build', description: 'Use our simple dashboard to install apps and customize your site.' },
  { number: 3, title: 'Launch & Grow', description: 'Go live and utilize our resources to expand your online presence.' },
];

export const PRICING_PLANS: PricingPlan[] = [
  {
    name: 'Starter',
    description: 'Perfect for small personal websites or blogs getting started.',
    monthlyPrice: 9,
    yearlyPrice: 90,
    features: ['1 Website', '10GB SSD Storage', '1-Click Installer', 'Free SSL'],
    isPopular: false,
  },
  {
    name: 'Pro Host',
    description: 'Our most popular plan for growing businesses and high-traffic sites.',
    monthlyPrice: 19,
    yearlyPrice: 190,
    features: ['Unlimited Websites', '100GB SSD Storage', 'Dedicated IP', 'Daily Backups', 'Priority Support'],
    isPopular: true,
  },
  {
    name: 'Enterprise',
    description: 'Powerful hosting solutions built for large agencies and corporations.',
    monthlyPrice: 49,
    yearlyPrice: 490,
    features: ['Everything in Pro Host', 'Unlimited Storage', 'Managed Service', 'Advanced DDoS Protection'],
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