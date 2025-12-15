import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.moduizzy.stockmobile",
  appName: "재고이찌",
  webDir: "dist",

  server: {
    url: "https://m.moduizzy.com",
    allowNavigation: ["moduizzy.com", "*.moduizzy.com"],
  },
};

export default config;
