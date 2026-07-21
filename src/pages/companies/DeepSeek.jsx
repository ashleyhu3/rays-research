import { C } from '../../config/colors';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

export default function DemandDeepSeek({ weeks: W }) {
  const { liveData: ld } = useData();

  return (
    <EditableGrid viewId="demand-deepseek">
      {orComboCard(ld?.openrouterRanks, 'DeepSeek', W, C.deepseek, 'ds', ld)}

      <RevPerTokenCard
        chartId="ds-revtoken"
        provider="DeepSeek"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.deepseek}
      />
    </EditableGrid>
  );
}
