import AppShell from '@/components/AppShell';
import LegacyEngine from '@/components/LegacyEngine';
import SidebarToggle from '@/components/SidebarToggle';

export default function Home() {
  return (
    <>
      <AppShell />
      <SidebarToggle />
      <LegacyEngine />
    </>
  );
}
