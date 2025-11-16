"use client";

import { motion, animate } from "framer-motion";
import { ArrowRight, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { Button } from "@/components/ui/button";

function ElegantShape({
    className,
    delay = 0,
    width = 400,
    height = 100,
    rotate = 0,
    gradient = "from-white/[0.08]",
}: {
    className?: string;
    delay?: number;
    width?: number;
    height?: number;
    rotate?: number;
    gradient?: string;
}) {
    return (
        <motion.div
            initial={{
                opacity: 0,
                y: -150,
                rotate: rotate - 15,
            }}
            animate={{
                opacity: 1,
                y: 0,
                rotate: rotate,
            }}
            transition={{
                duration: 2.4,
                delay,
                ease: [0.23, 0.86, 0.39, 0.96],
                opacity: { duration: 1.2 },
            }}
            className={cn("absolute", className)}
        >
            <motion.div
                animate={{
                    y: [0, 15, 0],
                }}
                transition={{
                    duration: 12,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                }}
                style={{
                    width,
                    height,
                }}
                className="relative"
            >
                <div
                    className={cn(
                        "absolute inset-0 rounded-full",
                        "bg-gradient-to-r to-transparent",
                        gradient,
                        "backdrop-blur-[2px] border-2 border-white/[0.15]",
                        "shadow-[0_8px_32px_0_rgba(255,255,255,0.1)]",
                        "after:absolute after:inset-0 after:rounded-full",
                        "after:bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.2),transparent_70%)]"
                    )}
                />
            </motion.div>
        </motion.div>
    );
}

function Hero({
    badge = "AI-Powered Excellence",
    title1 = "Calibr",
    title2 = "Next Generation Intelligent AI Recruitment Platform",
}: {
    badge?: string;
    title1?: string;
    title2?: string;
}) {
    const fadeUpVariants = {
        hidden: { opacity: 0, y: 30 },
        visible: {
            opacity: 1,
            y: 0,
            transition: {
                duration: 1,
                delay: 0.5,
                ease: [0.25, 0.4, 0.25, 1] as [number, number, number, number],
            },
        },
    };

    const initialStats = [
        { value: 0, target: 95, label: "Accuracy Rate", suffix: "%" },
        { value: 0, target: 500, label: "Companies Using", prefix: "+" },
        { value: 0, target: 78, label: "Time Saved", suffix: "%" },
    ];

    const [stats, setStats] = useState(initialStats);

    useEffect(() => {
        initialStats.forEach((stat, index) => {
            animate(0, stat.target, {
                duration: 2.5,
                delay: 1.5 + index * 0.3,
                onUpdate: (latest) => {
                    setStats(prev => {
                        const updated = [...prev];
                        updated[index].value = Math.floor(latest);
                        return updated;
                    });
                },
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-gradient-to-br from-[#0A0A18] via-[#0D0D20] to-[#0A0A18]">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/10 via-transparent to-rose-900/10" />
            
            <div className="absolute inset-0 overflow-hidden">
                <ElegantShape
                    delay={0.3}
                    width={600}
                    height={140}
                    rotate={12}
                    gradient="from-indigo-500/[0.15]"
                    className="left-[-10%] md:left-[-5%] top-[15%] md:top-[20%]"
                />

                <ElegantShape
                    delay={0.5}
                    width={500}
                    height={120}
                    rotate={-15}
                    gradient="from-rose-500/[0.15]"
                    className="right-[-5%] md:right-[0%] top-[70%] md:top-[75%]"
                />

                <ElegantShape
                    delay={0.4}
                    width={300}
                    height={80}
                    rotate={-8}
                    gradient="from-violet-500/[0.15]"
                    className="left-[5%] md:left-[10%] bottom-[5%] md:bottom-[10%]"
                />

                <ElegantShape
                    delay={0.6}
                    width={200}
                    height={60}
                    rotate={20}
                    gradient="from-amber-500/[0.15]"
                    className="right-[15%] md:right-[20%] top-[10%] md:top-[15%]"
                />

                <ElegantShape
                    delay={0.7}
                    width={150}
                    height={40}
                    rotate={-25}
                    gradient="from-cyan-500/[0.15]"
                    className="left-[20%] md:left-[25%] top-[5%] md:top-[10%]"
                />
            </div>

            <div className="relative z-10 container mx-auto px-4 md:px-6 ">
                <div className="flex flex-col lg:flex-row items-center justify-between">
                    {/* Left Content */}
                    <div className="max-w-2xl text-left lg:mr-12 mt-24">
                        <motion.div
                            variants={fadeUpVariants}
                            initial="hidden"
                            animate="visible"
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-indigo-500/10 to-rose-500/10 border border-white/[0.08] mb-8 md:mb-10 shadow-lg"
                        >
                            <div className="flex items-center gap-2">
                                <Zap className="h-3 w-3 fill-amber-400" />
                                <span className="text-sm text-white/70 tracking-wide font-medium">
                                    {badge}
                                </span>
                            </div>
                        </motion.div>

                        <motion.div
                            variants={fadeUpVariants}
                            initial="hidden"
                            animate="visible"
                        >
                            <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold mb-6 md:mb-8 tracking-tight">
                                <span className="bg-clip-text text-transparent bg-gradient-to-b from-white to-white/90">
                                    {title1}
                                </span>
                                <br />
                                <span
                                    className={cn(
                                        "text-2xl sm:text-3xl md:text-4xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 via-white to-rose-300 mt-4 block"
                                    )}
                                >
                                    {title2}
                                </span>
                            </h1>
                        </motion.div>

                        <motion.div
                            variants={fadeUpVariants}
                            initial="hidden"
                            animate="visible"
                        >
                            <p className="text-lg md:text-xl text-white/60 mb-10 leading-relaxed font-light max-w-xl">
                                Revolutionizing recruitment with AI-powered candidate evaluation. 
                                Experience bias-free hiring with our advanced aptitude, coding, 
                                technical, and HR assessment modules.
                            </p>
                        </motion.div>

                        <motion.div
                            variants={fadeUpVariants}
                            initial="hidden"
                            animate="visible"
                            className="flex flex-col sm:flex-row gap-4 mb-16"
                        >
                            <Button className="group h-full relative px-8 py-4 bg-gradient-to-r from-indigo-500 to-rose-500 rounded-lg font-medium text-white transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/30">
                                <span className="flex items-center justify-center gap-2">
                                    Get Started <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                                </span>
                            </Button>
                            <Button className="px-8 h-full py-4 bg-white/5 border border-white/10 rounded-lg font-medium text-white/80 transition-all duration-300 hover:bg-white/10 hover:text-white">
                                View Demo
                            </Button>
                        </motion.div>

                        {/* Stats Section */}
                        <motion.div
                            variants={fadeUpVariants}
                            initial="hidden"
                            animate="visible"
                            className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12"
                        >
                            {stats.map((stat, index) => (
                                <div key={index} className="p-6 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10">
                                    <div className="text-3xl font-bold text-white mb-2">
                                        {stat.prefix}{stat.value}{stat.suffix}
                                    </div>
                                    <div className="text-white/60 text-sm">{stat.label}</div>
                                </div>
                            ))}
                        </motion.div>
                    </div>

                    {/* Right Side - Placeholder for Illustration */}
                    <motion.div 
                        variants={fadeUpVariants}
                        initial="hidden"
                        animate="visible"
                        className="flex-1 hidden lg:flex items-center justify-center"
                    >
                        <div className="w-full h-fit bg-gradient-to-br from-indigo-500/10 to-rose-500/10 rounded-4xl border border-white/10 backdrop-blur-sm flex items-center justify-center">
                            <div className="text-white/40 text-center rounded-4xl">
                                <Image 
                                    src="/interview.png" 
                                    alt="Illustration" 
                                    width={500}
                                    height={500}
                                    className="rounded-4xl h-max" 
                                    priority
                                />
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#0A0A18] via-transparent to-transparent pointer-events-none" />
        </div>
    );
}

export { Hero };