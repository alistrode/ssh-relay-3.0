#!/bin/bash
# Demo script to showcase the SSH Manager CLI interactive interface

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

clear
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}         SSH Manager CLI - Interactive Demo${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

echo -e "${GREEN}✨ Welcome to SSH Manager CLI!${NC}"
echo
echo "This demo will show you the key features of the interactive interface."
echo

echo -e "${YELLOW}📋 Main Features:${NC}"
echo "  • Interactive menu with numbered choices"
echo "  • Guided server setup wizard"
echo "  • Server management (add, list, test, remove)"
echo "  • Quick SSH connections"
echo "  • File synchronization"
echo "  • SSH tunnel creation"
echo "  • System monitoring"
echo

echo -e "${YELLOW}🚀 To start the interactive mode, run:${NC}"
echo
echo "    ssh-manager"
echo "    ssh-manager -i"
echo "    ssh-manager --interactive"
echo

echo -e "${YELLOW}📝 The interactive mode will show you:${NC}"
echo
echo "  1. Main menu with 8 options"
echo "  2. Server management submenu"
echo "  3. Guided wizards for complex tasks"
echo "  4. Server selection menus"
echo "  5. Real-time feedback with colors and emojis"
echo

echo -e "${YELLOW}🎯 Example: Adding a Server${NC}"
echo
echo "When you choose 'Server Management' → 'Add New Server', you'll get:"
echo "  • Step-by-step wizard"
echo "  • Input validation"
echo "  • Clear examples for each field"
echo "  • Review before saving"
echo "  • Option to test connection"
echo

echo -e "${YELLOW}💡 Tips:${NC}"
echo "  • Press 0 to go back in any menu"
echo "  • Press Ctrl+C to exit anytime"
echo "  • All configurations are saved in .env file"
echo "  • Compatible with MCP server"
echo

read -p "Press Enter to see the main menu preview..."
echo

cat << 'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
           SSH Manager CLI v2.0.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1) 🖥️  Server Management
     Add, list, test, and manage SSH servers

  2) 💻 Quick Connect
     Connect to a server via SSH

  3) 🔄 File Synchronization
     Push/pull files with rsync

  4) 🔧 SSH Tunnels
     Create and manage SSH tunnels

  5) 📊 System Monitoring
     Monitor server resources

  6) 🚀 Execute Commands
     Run commands on servers

  7) ⚙️  Configuration
     Edit settings and preferences

  8) ℹ️  Help & Documentation
     View help and examples

  0) Exit

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Choose an option [0-8]: _
EOF

echo
echo -e "${GREEN}✅ Ready to try it yourself!${NC}"
echo
echo "Run: ssh-manager"
echo