// components/homepage/Footer.tsx

import React from 'react';
import Link from 'next/link';
import { Facebook, Twitter, Instagram, Linkedin } from 'lucide-react';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  const footerLinks = [
    { title: 'Company', links: ['About Us', 'Careers', 'Blog', 'Contact'] },
    { title: 'Resources', links: ['Knowledge Base', 'System Status', 'Migrate'] },
    { title: 'Legal', links: ['Terms of Service', 'Privacy Policy', 'SLA'] },
  ];

  const SocialIcon = ({ Icon, href }: { Icon: React.ElementType, href: string }) => (
    <Link href={href} className="text-secondary hover-text-primary me-3">
      <Icon size={24} />
    </Link>
  );

  return (
    <footer className="bg-dark text-white pt-5 pb-3">
      <div className="container">
        {/* Top Section: Links and Social */}
        <div className="row pb-4 border-bottom border-secondary-subtle">
          
          {/* Logo/Brand */}
          <div className="col-lg-3 col-md-6 mb-4">
            <Link href="/" className="text-white text-decoration-none fs-4 fw-bold mb-3 d-block">
              RaptorHost
            </Link>
            <p className="text-secondary small">
              Premium web hosting, designed for speed and reliability.
            </p>
          </div>

          {/* Navigation Links */}
          {footerLinks.map((col, index) => (
            <div key={index} className="col-lg-2 col-md-6 mb-4">
              <h4 className="fs-5 fw-semibold mb-3">{col.title}</h4>
              <ul className="list-unstyled">
                {col.links.map((link, i) => (
                  <li key={i} className="mb-2">
                    <Link href="#" className="text-secondary text-decoration-none small hover-text-primary">
                      {link}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Social Icons */}
          <div className="col-lg-3 col-md-6 mb-4">
            <h4 className="fs-5 fw-semibold mb-3">Connect</h4>
            <div className="d-flex">
              <SocialIcon Icon={Facebook} href="#" />
              <SocialIcon Icon={Twitter} href="#" />
              <SocialIcon Icon={Instagram} href="#" />
              <SocialIcon Icon={Linkedin} href="#" />
            </div>
          </div>
        </div>

        {/* Bottom Section: Copyright */}
        <div className="text-center text-secondary small pt-3">
          &copy; {currentYear} RaptorHost. All rights reserved. Built with Next.js and Bootstrap.
        </div>
      </div>
    </footer>
  );
}