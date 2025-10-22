import { createRootRoute, Outlet } from "@tanstack/react-router";

const RootLayout = () => (
  <div className="w-full h-screen flex flex-col">
    <Outlet />
  </div>
);

export const Route = createRootRoute({
  component: RootLayout,
});
