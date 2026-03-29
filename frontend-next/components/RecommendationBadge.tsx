type Props = {
  value: 'BUY' | 'HOLD' | 'SELL';
};

export default function RecommendationBadge({ value }: Props) {
  const className =
    value === 'BUY' ? 'badge buy' : value === 'SELL' ? 'badge sell' : 'badge hold';

  return <span className={className}>{value}</span>;
}
