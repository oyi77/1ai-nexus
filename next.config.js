/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  // Set outputFileTracingRoot to prevent Next.js from detecting parent directory as workspace
  // The parent /home/openclaw/ has package-lock.json causing wrong workspace detection
  outputFileTracingRoot: path.join(__dirname, '../'),
  
  // Keep other default settings explicit for clarity
  reactStrictMode: true,
  poweredByHeader: false,
};

module.exports = nextConfig;
