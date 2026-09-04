export function WordTags({ tags }: { tags: readonly string[] }) {
  return <div className="word-tags">{tags.slice(0,2).map(tag => <span className="topic-tag" key={tag}>{tag}</span>)}{tags.length > 2 && <details><summary>+{tags.length-2} tags</summary>{tags.slice(2).map(tag => <span className="topic-tag" key={tag}>{tag}</span>)}</details>}</div>
}
