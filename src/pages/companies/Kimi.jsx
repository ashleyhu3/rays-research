import { C } from '../../config/colors';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

export default function DemandKimi({ weeks: W }) {
  const { liveData: ld } = useData();

  return (
    <EditableGrid viewId="demand-kimi">
      {orComboCard(ld?.openrouterRanks, 'Moonshot AI', W, C.kimi, 'km', ld)}

      <RevPerTokenCard
        chartId="km-revtoken"
        provider="Moonshot AI"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.kimi}
      />
    </EditableGrid>
  );
}
