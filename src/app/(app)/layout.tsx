import { AppSidebar } from "@/components/AppSidebar";
import { VeriChatProvider } from "@/components/veri-chat/veri-chat-context";
import VeriComposer from "@/components/veri-chat/VeriComposer";
import VeriChatPanel from "@/components/veri-chat/VeriChatPanel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
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
      <Toaster />
    </VeriChatProvider>
  );
}
