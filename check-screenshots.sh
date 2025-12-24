#!/bin/bash
# Payment Screenshot Manager
# Usage: ./check-screenshots.sh [verified|rejected|pending|all|download]

ACTION="${1:-all}"
TOKEN="${SCREENSHOT_DOWNLOAD_TOKEN:-}"
BASE_URL="https://scriptclient-production.up.railway.app/screenshots"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Check if token is provided
if [ -z "$TOKEN" ]; then
    echo -e "${RED}❌ Error: SCREENSHOT_DOWNLOAD_TOKEN not set${NC}"
    echo -e "${YELLOW}Set it with: export SCREENSHOT_DOWNLOAD_TOKEN='your-token'${NC}"
    echo -e "${YELLOW}Or pass it: SCREENSHOT_DOWNLOAD_TOKEN='your-token' ./check-screenshots.sh${NC}"
    exit 1
fi

# Function to get screenshot count
get_screenshot_count() {
    local status=$1
    curl -s -H "x-download-token: $TOKEN" "$BASE_URL/$status"
}

# Function to show summary
show_summary() {
    echo -e "\n${CYAN}📊 Payment Screenshots Summary${NC}"
    echo -e "${CYAN}================================${NC}\n"

    # Verified
    verified=$(get_screenshot_count "verified")
    verified_count=$(echo "$verified" | jq -r '.count')
    echo -e "${GREEN}✅ Verified:  $verified_count screenshots${NC}"
    if [ "$verified_count" -gt 0 ]; then
        echo "$verified" | jq -r '.files[]' | while read file; do
            echo -e "   ${GRAY}- $file${NC}"
        done
    fi

    # Rejected
    rejected=$(get_screenshot_count "rejected")
    rejected_count=$(echo "$rejected" | jq -r '.count')
    echo -e "\n${RED}❌ Rejected:  $rejected_count screenshots${NC}"
    if [ "$rejected_count" -gt 0 ]; then
        echo "$rejected" | jq -r '.files[]' | while read file; do
            echo -e "   ${GRAY}- $file${NC}"
        done
    fi

    # Pending
    pending=$(get_screenshot_count "pending")
    pending_count=$(echo "$pending" | jq -r '.count')
    echo -e "\n${YELLOW}⏳ Pending:   $pending_count screenshots${NC}"
    if [ "$pending_count" -gt 0 ]; then
        echo "$pending" | jq -r '.files[]' | while read file; do
            echo -e "   ${GRAY}- $file${NC}"
        done
    fi

    total=$((verified_count + rejected_count + pending_count))
    echo -e "\n${CYAN}📦 Total: $total screenshots collected${NC}\n"
}

# Function to download screenshots
download_screenshots() {
    local status=$1

    echo -e "\n${CYAN}📥 Downloading $status screenshots...${NC}"

    response=$(get_screenshot_count "$status")
    count=$(echo "$response" | jq -r '.count')

    if [ "$count" -eq 0 ]; then
        echo -e "${YELLOW}No files to download in $status folder${NC}"
        return
    fi

    # Create local folder
    mkdir -p "$status"

    # Download each file
    echo "$response" | jq -r '.files[]' | while read file; do
        echo -e "  ${GRAY}Downloading $file...${NC}"
        curl -s -H "x-download-token: $TOKEN" \
            "$BASE_URL/$status/$file" \
            -o "$status/$file"
    done

    echo -e "${GREEN}✅ Downloaded $count files to ./$status/${NC}"
}

# Main logic
case "$ACTION" in
    verified)
        response=$(get_screenshot_count "verified")
        count=$(echo "$response" | jq -r '.count')
        echo -e "\n${GREEN}✅ Verified: $count files${NC}"
        echo "$response" | jq -r '.files[]' | while read file; do
            echo "   - $file"
        done
        ;;
    rejected)
        response=$(get_screenshot_count "rejected")
        count=$(echo "$response" | jq -r '.count')
        echo -e "\n${RED}❌ Rejected: $count files${NC}"
        echo "$response" | jq -r '.files[]' | while read file; do
            echo "   - $file"
        done
        ;;
    pending)
        response=$(get_screenshot_count "pending")
        count=$(echo "$response" | jq -r '.count')
        echo -e "\n${YELLOW}⏳ Pending: $count files${NC}"
        echo "$response" | jq -r '.files[]' | while read file; do
            echo "   - $file"
        done
        ;;
    download)
        echo -e "\n${CYAN}Download which folder?${NC}"
        echo -e "${GREEN}1. Verified${NC}"
        echo -e "${RED}2. Rejected${NC}"
        echo -e "${YELLOW}3. Pending${NC}"
        echo -e "${CYAN}4. All${NC}"
        read -p "Enter choice (1-4): " choice

        case $choice in
            1) download_screenshots "verified" ;;
            2) download_screenshots "rejected" ;;
            3) download_screenshots "pending" ;;
            4)
                download_screenshots "verified"
                download_screenshots "rejected"
                download_screenshots "pending"
                ;;
            *) echo -e "${RED}Invalid choice${NC}" ;;
        esac
        ;;
    *)
        show_summary
        ;;
esac
