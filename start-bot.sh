#!/bin/bash

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT="src/botfetch.js"   # resilient version with multiple connection strategies

echo -e "${GREEN}🔹 Stopping old PM2 process...${NC}"
pm2 stop myclient 2>/dev/null
pm2 delete myclient 2>/dev/null

echo -e "${GREEN}🔹 Setting environment and starting bot with PM2...${NC}"
export NODE_OPTIONS="--dns-result-order=ipv4first"
pm2 start $SCRIPT --name myclient

if pm2 list | grep -q myclient; then
  echo -e "${GREEN}✅ Bot process is running with PM2 as 'myclient'.${NC}"
else
  echo -e "${RED}❌ Failed to start bot with PM2.${NC}"
  exit 1
fi

echo -e "${GREEN}🔹 Tail logs with:${NC} pm2 logs myclient"
