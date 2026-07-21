import { C } from '../../config/colors';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

export default function DemandXAI({ weeks: W }) {
  const { liveData: ld } = useData();

  return (
    <EditableGrid viewId="demand-xai">
      {orComboCard(ld?.openrouterRanks, 'xAI', W, C.xai, 'xai', ld)}

      <RevPerTokenCard
        chartId="xai-revtoken"
        provider="xAI"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.xai}
      />
    </EditableGrid>
  );
}
