import { C } from '../../config/colors';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

export default function DemandZhipu({ weeks: W }) {
  const { liveData: ld } = useData();

  return (
    <EditableGrid viewId="demand-zhipu">
      {orComboCard(ld?.openrouterRanks, 'Zhipu AI', W, C.zhipu, 'zh', ld)}

      <RevPerTokenCard
        chartId="zh-revtoken"
        provider="Zhipu AI"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.zhipu}
        ticker="2513.HK"
      />
    </EditableGrid>
  );
}
