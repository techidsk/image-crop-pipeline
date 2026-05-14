import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        primaryShadcn: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        ink: "#1d242f",
        muted: "#657384",
        line: "#d5dce3",
        paper: "#fcfcfa",
        canvas: "#f2f4f1",
        primary: "#1c6b62",
        primaryDark: "#0f6f64",
        danger: "#8a2525",
        warning: "#6f4d18"
      },
      fontFamily: {
        sans: ["Inter", '"Segoe UI"', "system-ui", "sans-serif"]
      },
      boxShadow: {
        soft: "0 16px 38px rgba(30, 42, 38, 0.06)",
        selected: "0 0 0 2px rgba(28, 107, 98, 0.2)"
      }
    }
  },
  plugins: [tailwindcssAnimate]
};
