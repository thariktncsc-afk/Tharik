import AppShell from '@/components/AppShell';
import LegacyEngine from '@/components/LegacyEngine';
import MobileNav from '@/components/MobileNav';

export default function Home() {
  return (
    <>
      <AppShell />
      <MobileNav />
      <LegacyEngine />
    </>
  );
}
