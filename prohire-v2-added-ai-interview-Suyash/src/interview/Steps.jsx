/** The five-step progress bar at the top of every candidate screen. */
export default function Steps({ n }) {
  return (
    <div className="stepper" role="progressbar" aria-label={`Interview step ${n} of 5`} aria-valuemin="1" aria-valuemax="5" aria-valuenow={n}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}
    </div>
  )
}
