## Variant: Card Grid

### Design stance
Settings organized as independent card sections — each card is a self-contained configuration unit. The grid layout (auto-fill, minmax 360px) naturally reflows from 3-column to 2-column to single-column on smaller viewports. This matches the existing dashboard's card-based KPI layout.

### Key choices
- Layout: CSS Grid auto-fill, cards flow naturally
- Typography: Project's Fira Sans + Fira Code tokens
- Color: Full OKLCH token compatibility with existing dark theme
- Interaction: Inline editing with dirty-tracking "保存全部 *" button; per-card save/reset actions

### Trade-offs
- Strong at: Visual density, scan-ability, matches existing dashboard patterns (KPI cards, panels)
- Weak at: Long form scrolling (6 cards on small screen = lots of scrolling); less discoverable for first-time users

### Best for
- Users who already know the dashboard layout
- Dashboards where settings feel like "cards among cards"
- Quick-adjustment workflows (each card is independently actionable)
