/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#2E2B2B', tint: '#5B2D56', background: '#F8F4EC',
    foreground: '#2E2B2B', card: '#FFFCF6', cardForeground: '#2E2B2B',
    primary: '#5B2D56', primaryForeground: '#F8F4EC',
    secondary: '#EDE6F3', secondaryForeground: '#5B2D56',
    muted: '#F0EAE0', mutedForeground: '#786F6A',
    accent: '#8CAA8F', accentForeground: '#2E2B2B',
    destructive: '#9B5149', destructiveForeground: '#FFFCF6',
    border: '#E5DCCF', input: '#E5DCCF',
    lavender: '#EDE6F3', lavenderBorder: '#D8CCDF', sage: '#8CAA8F', taupe: '#C8B9A5', gold: '#C7A34A',
  },
  radius: 18,
};

export default colors;
