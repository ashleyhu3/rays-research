import { C } from '../../config/colors';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import RevPerTokenCard from '../../components/chart/RevPerTokenCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

export default function DemandQwen({ weeks: W }) {
  const { liveData: ld } = useData();

  return (
    <EditableGrid viewId="demand-qwen">
      {orComboCard(ld?.openrouterRanks, 'Alibaba (Qwen)', W, C.qwen, 'qw', ld)}

      <RevPerTokenCard
        chartId="qw-revtoken"
        provider="Alibaba (Qwen)"
        ranks={ld?.openrouterRanks}
        liveData={ld}
        weeks={W}
        color={C.qwen}
        ticker="BABA"
      />
    </EditableGrid>
  );
}
