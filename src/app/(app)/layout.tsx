import { AppSidebar } from "@/components/AppSidebar";
import { VeriChatProvider } from "@/components/veri-chat/veri-chat-context";
import VeriComposer from "@/components/veri-chat/VeriComposer";
import VeriChatPanel from "@/components/veri-chat/VeriChatPanel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SidebarProvider } from "@/components/sidebar-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <VeriChatProvider>
        <div className="flex h-screen overflow-hidden bg-background">
          <AppSidebar />
          <ResizablePanelGroup direction="horizontal" autoSaveId="projexa-shell-panels" className="flex-1 overflow-hidden">
            <ResizablePanel defaultSize={72} minSize={50}>
              <div className="h-full flex flex-col overflow-hidden">
                <div className="flex-1 overflow-auto">{children}</div>
                <VeriComposer />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={28} minSize={18} maxSize={40}>
              <VeriChatPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        {/* Toaster is mounted once in the root layout (src/app/layout.tsx)
            with position="top-right" richColors -- a second instance here
            used to duplicate every toast.error() call (both instances
            subscribe to the same global sonner store), which made write
            failures look inconsistent/easy to miss during testing instead
            of a single clear error. */}
      </VeriChatProvider>
    </SidebarProvider>
  );
}
