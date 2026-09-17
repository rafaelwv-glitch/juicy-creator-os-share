import { useEffect, type ReactNode } from "react";
import { captureDeviceFromLocation, installDeviceFetch } from "./device-client";

export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    captureDeviceFromLocation();
    installDeviceFetch();
  }, []);
  return <>{children}</>;
}
