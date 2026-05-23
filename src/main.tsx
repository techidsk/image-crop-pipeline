import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: "#1c6b62",
        colorInfo: "#1c6b62",
        borderRadius: 6
      },
      components: {
        Layout: {
          bodyBg: "#f4f6f5",
          siderBg: "#ffffff",
          headerBg: "#ffffff"
        },
        Menu: {
          itemSelectedBg: "#e3efed",
          itemSelectedColor: "#1c6b62",
          itemHeight: 36,
          iconSize: 15
        }
      }
    }}
  >
    <AntdApp>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AntdApp>
  </ConfigProvider>
);
