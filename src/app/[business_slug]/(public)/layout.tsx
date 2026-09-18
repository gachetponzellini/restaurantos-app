import { MotionProvider } from "@/components/motion/motion-provider";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  return (
    <div className="delivery-theme min-h-screen">
      <MotionProvider>{children}</MotionProvider>
    </div>
  );
}
