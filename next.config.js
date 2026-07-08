/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  // Use absolute path for distDir to avoid pm2 relative path resolution issues
  distDir: path.join(__dirname, '.next'),
  
  // Set outputFileTracingRoot to prevent Next.js from detecting parent directory as workspace
  // The parent /home/openclaw/ has package-lock.json causing wrong workspace detection
  outputFileTracingRoot: __dirname,
  
  // Keep other default settings explicit for clarity
  reactStrictMode: true,
  poweredByHeader: false,
};

module.exports = nextConfig;
