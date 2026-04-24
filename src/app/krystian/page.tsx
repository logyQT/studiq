import React from "react";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0a0a0f] text-[#e8e8f0] flex flex-col items-center justify-center p-6">
      <div className="max-w-4xl text-center">
        <span className="px-3 py-1 text-xs font-medium uppercase tracking-widest text-[#6c63ff] border border-[#6c63ff]/30 rounded-full bg-[#6c63ff]/10">Projekt Wdrożeniowy 2026</span>

        <h1 className="mt-8 text-6xl md:text-8xl font-extrabold tracking-tighter">
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#6c63ff] to-[#ff6584]">Studiq</span>
        </h1>

        <p className="mt-6 text-lg text-[#6b6b85] max-w-xl mx-auto">Platforma e-learningowa wspierająca studentów w przygotowaniu do egzaminów z wykorzystaniem AI.</p>

        <div className="mt-10 flex gap-4 justify-center">
          <button className="px-6 py-3 bg-[#6c63ff] hover:bg-[#5a52e0] text-white rounded-lg font-semibold transition-all">Zacznij naukę</button>
          <button className="px-6 py-3 border border-[#1e1e2e] hover:border-[#6c63ff]/50 bg-[#111118] text-[#e8e8f0] rounded-lg font-semibold transition-all">Panel Wykładowcy</button>
        </div>
      </div>
    </main>
  );
}
