import Link from "next/link";

export default function ReqsNotFound() {
  return (
    <article className="doc">
      <h1>Requirements page not found</h1>
      <p>
        There is no requirements document at this address. The hub lists every published page:{" "}
        <Link href="/reqs">back to the requirements hub</Link>.
      </p>
    </article>
  );
}
