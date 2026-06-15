## Variant: List Panel

### Design stance
A classic macOS/Windows-style settings layout: left sidebar for section navigation, right panel for settings rows. Each setting is a horizontal row with a descriptive label + hint on the left and the control on the right. More editorial and linear — designed for reading and discovering options one by one.

### Key choices
- Layout: Fixed 220px sidebar + fluid main panel
- Typography: Project's Fira Sans + Fira Code tokens
- Color: Full OKLCH token compatibility with existing dark theme
- Interaction: Sidebar navigation with section switching; dirty-tracking save button; audit stats as KPI cards

### Trade-offs
- Strong at: Discoverability (all sections visible in sidebar), comfortable read-flow, feels like "real settings"
- Weak at: Wasted horizontal space on wide screens; requires back-navigation between sections; less information-dense

### Best for
- First-time users exploring settings
- Screens with 10+ settings per section (scroll-friendly rows)
- Environments where settings changes are infrequent and deliberate
