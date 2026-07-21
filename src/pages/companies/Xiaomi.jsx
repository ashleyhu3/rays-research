import { C } from '../../config/colors';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

export default function DemandXiaomi({ weeks: W }) {
  const { liveData: ld } = useData();

  return (
    <EditableGrid viewId="demand-xiaomi">
      {orComboCard(ld?.openrouterRanks, 'Xiaomi', W, C.xiaomi, 'xm', ld)}

      <RevPerTokenCard
        chartId="xm-revtoken"
        provider="Xiaomi"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.xiaomi}
        ticker="1810.HK"
      />
    </EditableGrid>
  );
}
