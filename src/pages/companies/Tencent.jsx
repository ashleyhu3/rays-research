import { C } from '../../config/colors';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

export default function DemandTencent({ weeks: W }) {
  const { liveData: ld } = useData();

  return (
    <EditableGrid viewId="demand-tencent">
      {orComboCard(ld?.openrouterRanks, 'Tencent', W, C.tencent, 'tc', ld)}

      <RevPerTokenCard
        chartId="tc-revtoken"
        provider="Tencent"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.tencent}
        ticker="0700.HK"
      />
    </EditableGrid>
  );
}
